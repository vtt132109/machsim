/**
 * Stylesheet of the schematic scene, shared by the live canvas (injected into its <svg>) and by
 * SVG / PNG export (embedded in the exported file together with {@link EXPORT_TOKENS}, so the
 * exported drawing does not depend on the application's CSS).
 */

/** Scene rules; colours come from the theme tokens (see src/ui/theme.css). */
export const SCENE_CSS = `
.ms-scene text { font-family: var(--font, 'Segoe UI', sans-serif); dominant-baseline: central; stroke: none; }
.ms-part { color: var(--part); }
.ms-part.is-selected { color: var(--part-selected); }
.ms-part.is-excluded { opacity: 0.55; }
.ms-part.is-not-fitted { opacity: 0.3; }
.ms-part.is-not-fitted .ms-sym { stroke-dasharray: 4 3; }
.ms-sym { fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.ms-sym-text { fill: currentColor; }
.ms-part-label { fill: var(--part); font-size: 11px; }
.ms-part.is-selected .ms-part-label { fill: var(--part-selected); }
.ms-part-unknown { fill: none; stroke: var(--erc-error); stroke-dasharray: 4 3; stroke-width: 1.2; }
.ms-glow { pointer-events: none; }
.ms-part.is-annotation { color: var(--text-dim, #78808a); }
.ms-ctl { fill: var(--canvas, #fff); stroke: currentColor; stroke-width: 1; pointer-events: none; }
.ms-ctl.is-on { fill: var(--accent, #2e7d32); }
.ms-nc-mark line { stroke: var(--erc-warning, #b26a00); stroke-width: 1.4; stroke-linecap: round; pointer-events: none; }
.ms-part.is-blown .ms-sym { opacity: 0.45; }
.ms-blown-mark line { stroke: var(--danger, #d32f2f); stroke-width: 2.5; stroke-linecap: round; pointer-events: none; }
.ms-hot-mark { fill: none; stroke: var(--warning, #f9a825); stroke-width: 2; stroke-dasharray: 4 3; pointer-events: none; }
.ms-fault-badge circle { fill: var(--warning, #f9a825); stroke: var(--canvas, #fff); stroke-width: 1; }
.ms-fault-badge text { fill: #000; font-weight: 700; pointer-events: none; }
.ms-wire { fill: none; stroke: var(--wire); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.ms-wire.is-selected { stroke: var(--wire-selected) !important; stroke-width: 2.4; }
.ms-junction { fill: var(--junction); }
.ms-netlabel { color: var(--label); }
.ms-netlabel text { fill: var(--label); font-size: 11px; font-weight: 600; }
.ms-netlabel .ms-netlabel-mark { fill: none; stroke: var(--label); stroke-width: 1.2; }
.ms-netlabel.is-selected { color: var(--wire-selected); }
.ms-netlabel.is-selected text { fill: var(--wire-selected); }
.ms-netlabel.is-selected .ms-netlabel-mark { stroke: var(--wire-selected); }
.ms-probe-flag { stroke: none; }
.ms-probe-flag-text { fill: #fff; font-size: 10px; font-weight: 600; }
.ms-probe-lead { fill: none; stroke-width: 1.2; }
.ms-probe-dot { stroke: var(--canvas); stroke-width: 1; }
.ms-probe.is-selected .ms-probe-flag { stroke: var(--wire-selected); stroke-width: 2; }
.ms-probe-value { fill: var(--text-dim); font-size: 10px; font-family: var(--mono, monospace) !important; }
.ms-probe-ref { fill: none; stroke-width: 1; stroke-dasharray: 3 2; }
.ms-note text { fill: var(--note-text); }
.ms-note.is-selected text { fill: var(--wire-selected); }
.ms-note-box { fill: none; stroke: var(--wire-selected); stroke-dasharray: 3 2; stroke-width: 0.8; }
.ms-erc-error { fill: var(--erc-error); }
.ms-erc-warning { fill: var(--erc-warning); }
.ms-erc-glyph { fill: #fff; font-size: 9px; font-weight: 700; text-anchor: middle; }
.ms-page-border { fill: none; stroke: var(--grid); stroke-width: 1.5; }
.ms-titleblock rect, .ms-titleblock line { fill: none; stroke: var(--grid); stroke-width: 1; }
.ms-titleblock text { fill: var(--text-dim); font-size: 9px; }
.ms-titleblock .ms-tb-title { fill: var(--text); font-size: 13px; font-weight: 600; }
.ms-sel-box { fill: var(--selection-fill); stroke: var(--part-selected); stroke-width: 0.8; stroke-dasharray: 3 2; pointer-events: none; }
.ms-bus { fill: none; stroke: var(--bus, var(--wire)); stroke-width: 4.2; stroke-linecap: round; stroke-linejoin: round; }
.ms-bus.is-selected { stroke: var(--wire-selected) !important; }
.ms-bus-junction { fill: var(--bus, var(--wire)); }
.ms-bus-entry { stroke: var(--bus, var(--wire)); stroke-width: 1.8; stroke-linecap: round; }
.ms-netlabel .ms-bus-entry-text { font-size: 10px; font-weight: 600; }
.ms-netlabel.is-global .ms-netlabel-mark { fill: var(--label); }
.ms-netlabel.is-global text { text-decoration: underline; }
.ms-connector { fill: var(--canvas); stroke: var(--label); stroke-width: 1.2; stroke-linejoin: round; }
.ms-netlabel-global .ms-connector { stroke-width: 2; }
.ms-netlabel-hier .ms-connector { stroke-dasharray: none; fill: var(--accent-weak, transparent); }
.ms-connector-dot { fill: var(--label); }
.ms-netlabel.is-selected .ms-connector { stroke: var(--wire-selected); }
.ms-netlabel .ms-connector-text { font-size: 10px; }
.ms-shape { color: var(--part); }
.ms-shape > :first-child { stroke: var(--part); stroke-width: 1.2; }
.ms-shape.is-selected > :first-child { stroke: var(--part-selected); }
.ms-comment-box { fill: #fff6bf; stroke: #d9a400; stroke-width: 0.8; }
.ms-comment text { fill: #3b3000 !important; }
.ms-comment .ms-comment-head { fill: #7a6200 !important; font-weight: 600; }
.ms-comment-pin { fill: #f2b705; stroke: #a07800; stroke-width: 0.8; }
.ms-comment.is-selected .ms-comment-box, .ms-comment.is-selected .ms-comment-pin { stroke: var(--wire-selected); stroke-width: 1.6; }
.ms-titleblock .ms-tb-value { fill: var(--text); font-size: 10px; }
.is-locked { opacity: 0.92; }
`;

/** Light palette used for exported drawings (print friendly, independent of the UI theme). */
export const EXPORT_TOKENS: Record<string, string> = {
  '--canvas': '#ffffff',
  '--grid': '#c8ced8',
  '--text': '#1d2330',
  '--text-dim': '#5b6475',
  '--part': '#1d2330',
  '--part-selected': '#1d2330',
  '--wire': '#1a4fd6',
  '--wire-selected': '#1a4fd6',
  '--pin': '#c62828',
  '--junction': '#1a4fd6',
  '--label': '#6a1b9a',
  '--note-text': '#3b4456',
  '--erc-error': '#c62828',
  '--erc-warning': '#b26a00',
  '--glow': '#ffd43b',
  '--bus': '#0b2e8a',
  '--accent-weak': '#e8f0fe',
  '--selection-fill': 'transparent',
  '--font': "'Segoe UI', Arial, sans-serif",
  '--mono': "Consolas, 'Courier New', monospace",
};

/** `<style>` text for an exported SVG: tokens on the root element + the scene rules. */
export function exportStyleText(tokens: Record<string, string> = EXPORT_TOKENS): string {
  const vars = Object.entries(tokens)
    .map(([k, v]) => `${k}:${v};`)
    .join('');
  return `svg{${vars}}${SCENE_CSS}`;
}

const SCENE_STYLE_ID = 'ms-scene-style';

/**
 * Install {@link SCENE_CSS} once into the document head so every on-screen scene (canvas,
 * component preview, print area) shares the rules. No-op outside a browser.
 */
export function ensureSceneStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(SCENE_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = SCENE_STYLE_ID;
  el.textContent = SCENE_CSS;
  document.head.appendChild(el);
}
