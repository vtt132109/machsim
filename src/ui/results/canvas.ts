/**
 * Browser helpers shared by every canvas-based view (grapher, instrument screens):
 * HiDPI canvas sizing, CSS custom-property lookup, trace colours and file downloads.
 * These touch the DOM and are only called from React effects / event handlers.
 */

/**
 * Size a canvas backing store for the device pixel ratio and return a context whose units are
 * CSS pixels. Re-assigning width/height also clears the canvas.
 */
export function setupHiDpiCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): CanvasRenderingContext2D | null {
  const dpr = Math.max(1, Math.min(4, globalThis.devicePixelRatio || 1));
  const w = Math.max(1, Math.round(cssWidth * dpr));
  const h = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  return ctx;
}

/** Value of a CSS custom property as seen from `el`, or `fallback` when unset. */
export function cssVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

const DARK_FALLBACK = ['#ffd43b', '#4dabf7', '#ff6b6b', '#69db7c', '#da77f2', '#ffa94d', '#3bc9db', '#f783ac'];
const LIGHT_FALLBACK = ['#1971c2', '#e8590c', '#2b8a3e', '#c2255c', '#6741d9', '#0c8599', '#e67700', '#495057'];

/** The 8-colour trace palette for a plot background ('dark' uses theme --trace-N tokens). */
export function tracePalette(el: Element, background: 'dark' | 'light'): string[] {
  return Array.from({ length: 8 }, (_, i) =>
    background === 'dark'
      ? cssVar(el, `--trace-${i + 1}`, DARK_FALLBACK[i])
      : cssVar(el, `--msr-light-trace-${i + 1}`, LIGHT_FALLBACK[i]),
  );
}

/** Offer a text file to the user via a temporary object URL. */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  downloadBlob(filename, blob);
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Save a canvas as PNG. */
export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(filename.endsWith('.png') ? filename : `${filename}.png`, blob);
  }, 'image/png');
}

/** File-name-safe version of a title. */
export function safeFileName(title: string): string {
  return title.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
}
