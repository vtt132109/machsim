/**
 * Helpers shared by the virtual instrument parts (instruments.ts) and the bench-style
 * instruments (benchInstruments.ts): display-group params, channel signals from pins, the
 * instrument box symbol and the column symbol of multi-input instruments.
 */
import type { SignalRef } from '../../model/types';
import type { InstrumentBindContext } from '../partkit';
import { boxSymbol, line, makeSymbol, pin, rect, text, type BoxPin } from '../symbols';
import type { ParamDef } from '../types';

export const disp = (p: ParamDef): ParamDef => ({ ...p, group: 'display' });

export function diff(ctx: InstrumentBindContext, pos: string, neg: string): SignalRef | null {
  const p = ctx.net(pos);
  if (p === null) return null;
  return { kind: 'voltage', pos: p, neg: ctx.net(neg) ?? '0' };
}

export function single(ctx: InstrumentBindContext, p: string): SignalRef | null {
  const n = ctx.net(p);
  return n === null ? null : { kind: 'voltage', pos: n, neg: '0' };
}

export function put(ch: Record<string, SignalRef>, key: string, s: SignalRef | null): void {
  if (s) ch[key] = s;
}

/** Names of the V/I elements this instance emitted (in emission order). */
export function emittedSources(ctx: InstrumentBindContext): string[] {
  return ctx.elements.filter((e) => e.type === 'V' || e.type === 'I').map((e) => e.name);
}

export function instrumentBox(title: string, bottom: BoxPin[], o: { w?: number; h?: number; right?: BoxPin[]; left?: BoxPin[] } = {}) {
  return boxSymbol({ w: o.w, h: o.h ?? 40, bottom, right: o.right, left: o.left, title, titleSize: 10, titlePos: { x: 0, y: -4 }, rounded: true });
}


export function columnSymbol(title: string, side: 'left' | 'right', names: string[], labels: string[], bottom: string[], w = 60) {
  const n = names.length;
  const y0 = -Math.floor(n / 2) * 10;
  const h = n * 10 + 20;
  const top = y0 - 10;
  const prims = [rect(-w / 2, top, w, h, undefined, 4), text(0, top + h / 2 + 4, title, 10, 'middle', true)];
  const pins = names.map((nm, i) => {
    const y = y0 + 10 * i;
    const x = side === 'left' ? -w / 2 - 10 : w / 2 + 10;
    prims.push(line(x, y, side === 'left' ? -w / 2 : w / 2, y));
    return pin(nm, x, y, side, { label: labels[i], type: side === 'left' ? 'input' : 'output' });
  });
  const by = top + h;
  bottom.forEach((nm, i) => {
    const x = -((bottom.length - 1) * 10) + 20 * i;
    prims.push(line(x, by, x, by + 10));
    pins.push(pin(nm, x, by + 10, 'down', { label: nm, type: 'input' }));
  });
  return makeSymbol(prims, pins, { refPos: { x: 0, y: top - 6 }, valuePos: { x: 0, y: by + 24 } });
}
