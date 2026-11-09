/**
 * Renders MachSim markup (src/model/richText.ts) — headings, paragraphs, lists, notes, images —
 * and formulas (src/model/formula.ts) as HTML. Used by the description box and the lesson theory.
 *
 *   <RichText text={box.text} images={box.images} />
 *   <MathView tex="\\frac{R_2}{R_1 + R_2}" display />
 */
import { Fragment, useMemo, type ReactNode } from 'react';
import type { DescriptionImage } from '../../model/types';
import { formulaText, parseFormula, type MathNode } from '../../model/formula';
import { parseRichText, type RichBlock, type RichInline } from '../../model/richText';
import { lt } from '../../i18n/learnUi';
import type { Lang } from '../../i18n';
import './learn.css';

/** Operators drawn without spacing (brackets, slash, comma …). */
const PUNCT = new Set(['(', ')', '[', ']', '|', ',', '/', '!', '⌊', '⌋', '⌈', '⌉']);

function mathNode(n: MathNode, key: number | string): ReactNode {
  switch (n.k) {
    case 'row':
      return (
        <span key={key} className="ms-math-row">
          {n.items.map((x, i) => mathNode(x, i))}
        </span>
      );
    case 'sym':
      return (
        <span key={key} className={n.kind === 'op' && PUNCT.has(n.text) ? 'ms-math-punct' : `ms-math-${n.kind}`}>
          {n.text}
        </span>
      );
    case 'script':
      return (
        <span key={key} className="ms-math-script">
          {mathNode(n.base, 'b')}
          {n.sup && n.sub ? (
            <span className="ms-math-scripts">
              <span className="ms-math-supin">{mathNode(n.sup, 'p')}</span>
              <span className="ms-math-subin">{mathNode(n.sub, 's')}</span>
            </span>
          ) : n.sup ? (
            <span className="ms-math-sup">{mathNode(n.sup, 'p')}</span>
          ) : n.sub ? (
            <span className="ms-math-sub">{mathNode(n.sub, 's')}</span>
          ) : null}
        </span>
      );
    case 'frac':
      return (
        <span key={key} className="ms-math-frac">
          <span className="ms-math-numer">{mathNode(n.num, 'n')}</span>
          <span className="ms-math-denom">{mathNode(n.den, 'd')}</span>
        </span>
      );
    case 'sqrt':
      return (
        <span key={key} className="ms-math-sqrt">
          <span className="ms-math-radical" aria-hidden="true">
            √
          </span>
          <span className="ms-math-radicand">{mathNode(n.body, 'r')}</span>
        </span>
      );
  }
}

/** A formula; `display` centres it on its own line. */
export function MathView({ tex, display }: { tex: string; display?: boolean }) {
  const node = useMemo(() => parseFormula(tex), [tex]);
  return (
    <span className={display ? 'ms-math ms-math-display' : 'ms-math'} role="math" aria-label={formulaText(node)}>
      {mathNode(node, 0)}
    </span>
  );
}

interface RenderCtx {
  images: Map<string, DescriptionImage>;
  lang?: Lang;
}

function imageEl(id: string, alt: string, ctx: RenderCtx, block: boolean, key: number | string): ReactNode {
  const img = ctx.images.get(id);
  if (!img) {
    return (
      <span key={key} className="ms-rich-missing">
        {lt('desc.missingImage', { id }, ctx.lang)}
      </span>
    );
  }
  const el = <img key={key} src={img.src} alt={alt || img.alt || lt('desc.imageAlt', undefined, ctx.lang)} className={block ? 'ms-rich-img-block' : 'ms-rich-img'} />;
  return block ? (
    <figure key={key} className="ms-rich-figure">
      {el}
      {alt ? <figcaption>{alt}</figcaption> : null}
    </figure>
  ) : (
    el
  );
}

function inlines(items: RichInline[], ctx: RenderCtx): ReactNode[] {
  return items.map((n, i) => {
    switch (n.kind) {
      case 'text':
        return <Fragment key={i}>{n.text}</Fragment>;
      case 'bold':
        return <strong key={i}>{inlines(n.children, ctx)}</strong>;
      case 'italic':
        return <em key={i}>{inlines(n.children, ctx)}</em>;
      case 'code':
        return <code key={i}>{n.text}</code>;
      case 'math':
        return <MathView key={i} tex={n.tex} />;
      case 'image':
        return imageEl(n.id, n.alt, ctx, false, i);
      case 'break':
        return <br key={i} />;
    }
  });
}

function block(b: RichBlock, i: number, ctx: RenderCtx): ReactNode {
  switch (b.kind) {
    case 'heading': {
      const H = b.level === 1 ? 'h3' : b.level === 2 ? 'h4' : 'h5';
      return <H key={i}>{inlines(b.inlines, ctx)}</H>;
    }
    case 'paragraph':
      return <p key={i}>{inlines(b.inlines, ctx)}</p>;
    case 'note':
      return (
        <div key={i} className="ms-rich-note">
          {inlines(b.inlines, ctx)}
        </div>
      );
    case 'list': {
      const L = b.ordered ? 'ol' : 'ul';
      return (
        <L key={i}>
          {b.items.map((it, j) => (
            <li key={j}>{inlines(it, ctx)}</li>
          ))}
        </L>
      );
    }
    case 'math':
      return (
        <div key={i} className="ms-rich-math">
          <MathView tex={b.tex} display />
        </div>
      );
    case 'image':
      return imageEl(b.id, b.alt, ctx, true, i);
    case 'rule':
      return <hr key={i} />;
  }
}

/** Rich text in MachSim markup. `lang` only affects the placeholder texts (missing picture). */
export function RichText({ text, images, lang, className }: { text: string; images?: DescriptionImage[]; lang?: Lang; className?: string }) {
  const blocks = useMemo(() => parseRichText(text), [text]);
  const ctx: RenderCtx = { images: new Map((images ?? []).map((im) => [im.id, im])), lang };
  return <div className={`ms-rich${className ? ` ${className}` : ''}`}>{blocks.map((b, i) => block(b, i, ctx))}</div>;
}
