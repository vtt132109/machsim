/**
 * Instrument face export (browser only for the capture; the SVG assembly is pure and tested):
 * an open instrument window's panel is cloned, every <canvas> (screens, previews) is replaced by
 * an <img> of its current pixels, the clone is serialised as XHTML into an SVG <foreignObject>
 * together with the page's stylesheets and the theme's CSS custom properties, and the SVG is
 * rasterised to PNG. Used by the window's "Save face as PNG" button and by File > Print
 * instrument faces.
 */

/** XML-escape text for an attribute or element body. */
export function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** `:root`-style block that re-declares CSS custom properties on the face wrapper. */
export function cssVariablesBlock(vars: Record<string, string>): string {
  const body = Object.entries(vars)
    .filter(([k]) => /^--[\w-]+$/.test(k))
    .map(([k, v]) => `${k}: ${v.replace(/[;{}<>]/g, '')};`)
    .join(' ');
  return `.msi-face-root { ${body} }`;
}

/**
 * SVG document showing serialised XHTML `markup` of size width × height (CSS px) with `css`
 * (stylesheet text) applied. The markup must be well-formed XHTML (XMLSerializer output).
 */
export function faceSvg(markup: string, css: string, width: number, height: number, background = '#ffffff'): string {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  // a CDATA section keeps the stylesheet intact (selectors may contain '>')
  const style = `<style><![CDATA[${css.replace(/]]>/g, ']] >')}]]></style>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="${xmlEscape(background)}"/>` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="msi-face-root" style="width:${w}px;height:${h}px;overflow:hidden">${style}${markup}</div>` +
    `</foreignObject></svg>`
  );
}

/** Text of every stylesheet the page can read (cross-origin sheets are skipped). */
export function collectCss(doc: Document): string {
  const parts: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) parts.push(rule.cssText);
    } catch {
      // not readable (cross-origin): skip
    }
  }
  return parts.join('\n');
}

/** CSS custom properties in effect at an element (theme tokens). */
export function customProperties(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  const view = el.ownerDocument.defaultView;
  if (!view) return out;
  const cs = view.getComputedStyle(el);
  for (let i = 0; i < cs.length; i++) {
    const name = cs.item(i);
    if (name.startsWith('--')) out[name] = cs.getPropertyValue(name).trim();
  }
  return out;
}

/** Serialise an element with its canvases frozen as images; returns the SVG and its size. */
export function snapshotSvg(el: HTMLElement): { svg: string; width: number; height: number } {
  const rect = el.getBoundingClientRect();
  const clone = el.cloneNode(true) as HTMLElement;
  const src = el.querySelectorAll('canvas');
  const dst = clone.querySelectorAll('canvas');
  src.forEach((canvas, i) => {
    const img = el.ownerDocument.createElement('img');
    try {
      img.src = canvas.toDataURL('image/png');
    } catch {
      img.alt = '';
    }
    img.setAttribute('style', `width:${canvas.clientWidth}px;height:${canvas.clientHeight}px;display:block`);
    dst[i]?.replaceWith(img);
  });
  // form values are properties, not attributes: copy them so the face shows the settings
  const srcInputs = el.querySelectorAll('input, select, textarea');
  const dstInputs = clone.querySelectorAll('input, select, textarea');
  srcInputs.forEach((input, i) => {
    const d = dstInputs[i];
    if (!d) return;
    if (input instanceof HTMLInputElement) d.setAttribute('value', input.value);
    else if (input instanceof HTMLSelectElement) {
      d.querySelectorAll('option').forEach((o, k) => (k === input.selectedIndex ? o.setAttribute('selected', 'selected') : o.removeAttribute('selected')));
    } else if (input instanceof HTMLTextAreaElement) d.textContent = input.value;
  });
  clone.style.width = `${rect.width}px`;
  const markup = new XMLSerializer().serializeToString(clone);
  const vars = { ...customProperties(el.ownerDocument.documentElement), ...customProperties(el) };
  const css = `${collectCss(el.ownerDocument)}\n${cssVariablesBlock(vars)}`;
  const bg = el.ownerDocument.defaultView?.getComputedStyle(el).backgroundColor || '#ffffff';
  return { svg: faceSvg(markup, css, rect.width, rect.height, bg === 'rgba(0, 0, 0, 0)' ? '#ffffff' : bg), width: rect.width, height: rect.height };
}

/** Rasterise an SVG to a PNG data URL at `scale` × its CSS size. */
export function svgToPngDataUrl(svg: string, width: number, height: number, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('no 2d context'));
        return;
      }
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => reject(new Error('face image failed to load'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** PNG data URL of an instrument face element. */
export async function captureFace(el: HTMLElement, scale = 2): Promise<string> {
  const { svg, width, height } = snapshotSvg(el);
  return svgToPngDataUrl(svg, width, height, scale);
}

/** Download a data URL as a file. */
export function downloadDataUrl(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
