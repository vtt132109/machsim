/**
 * Every control of every instrument panel explains itself on hover: each <input>, <select>,
 * <textarea> and <button> carries a non-empty title, or sits inside an element (field label,
 * switch group) that has one. Learners can point at any knob to see what it does.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it } from 'vitest';
import type { InstrumentBinding, InstrumentKind } from '../../model/types';
import { instrumentPanels } from './registry';
import { INSTRUMENT_KINDS } from './titles';
import { INSTRUMENT_CHANNELS, InstrumentStream } from './types';
import { setLang } from '../../i18n';
import { MatchDesigner } from './MatchDesigner';
import type { TwoPort } from './network';

const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'col', 'area', 'source', 'wbr']);
const CONTROLS = new Set(['input', 'select', 'textarea', 'button']);

/** Controls without a tooltip of their own or of an enclosing element (tag + a little context). */
export function untitledControls(html: string): string[] {
  const stack: { tag: string; titled: boolean }[] = [];
  const out: string[] = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const [, close, rawTag, attrs] = m;
    const tag = rawTag.toLowerCase();
    if (close) {
      // pop to the matching element (SSR markup is well formed)
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const titled = /\stitle="[^"]*\S[^"]*"/.test(attrs);
    if (CONTROLS.has(tag) && !titled && !stack.some((e) => e.titled)) {
      const after = html.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40).replace(/<[^>]+>/g, '').trim();
      out.push(`<${tag}${attrs.slice(0, 60)}> ${after}`);
    }
    if (!VOID.has(tag) && !attrs.endsWith('/')) stack.push({ tag, titled });
  }
  return out;
}

function render(kind: InstrumentKind, params: Record<string, string> = {}): string {
  const Panel = instrumentPanels[kind]!;
  const channels: InstrumentBinding['channels'] = {};
  for (const ch of INSTRUMENT_CHANNELS[kind]) channels[ch] = { kind: 'voltage', pos: `n_${ch}`, neg: '0' };
  const binding: InstrumentBinding = { refdes: 'X1', partId: `instruments/${kind}`, kind, params, channels, drives: [] };
  return renderToStaticMarkup(
    createElement(Panel, { binding, stream: new InstrumentStream(Object.keys(channels)), simTime: 0, running: false, params, onParamsChange: () => {} }),
  );
}

afterAll(() => setLang('vi'));

describe('instrument control tooltips', () => {
  it('the checker finds controls without a tooltip', () => {
    const html = '<div><label title="Gain"><input value="1"/></label><button type="button">Run</button><div title="Mode"><button>A</button></div><select><option>x</option></select></div>';
    expect(untitledControls(html).map((s) => s.split(' ')[0])).toEqual(['<button', '<select>']);
  });

  it('every control of the matching designer has a tooltip', () => {
    const pol = (m: number, d: number) => ({ re: m * Math.cos((d * Math.PI) / 180), im: m * Math.sin((d * Math.PI) / 180) });
    const s: TwoPort = { p11: pol(0.72, -116), p21: pol(2.6, 76), p12: pol(0.03, 57), p22: pol(0.73, -54) };
    for (const lang of ['vi', 'en'] as const) {
      setLang(lang);
      for (const mode of ['stability', 'conjugate', 'unilateral']) {
        const html = renderToStaticMarkup(createElement(MatchDesigner, { s, z0: 50, freq: 4e9, params: { 'match.mode': mode }, onParamsChange: () => {} }));
        expect(untitledControls(html), `${lang} ${mode}`).toEqual([]);
        // results are shown, not just the mode switch
        expect(html.length).toBeGreaterThan(1500);
      }
    }
  });

  for (const lang of ['vi', 'en'] as const) {
    it(`every instrument control has a tooltip (${lang})`, () => {
      setLang(lang);
      const missing: string[] = [];
      for (const kind of INSTRUMENT_KINDS) {
        // multimeter / generator modes show different controls: render each variant
        const VARIANTS: Partial<Record<InstrumentKind, Record<string, string>[]>> = {
          multimeter: [{ mode: 'v' }, { mode: 'a' }, { mode: 'ohm' }, { mode: 'db' }],
          'function-generator': [{ waveform: 'sine' }, { waveform: 'square' }, { waveform: 'triangle' }],
          oscilloscope: [{ 'trig.mode': 'single', 'trig.source': 'ext' }, {}],
          'oscilloscope-4ch': [{ 'trig.mode': 'single', 'trig.source': 'ext' }, {}],
          'bode-plotter': [{ mode: 'mag', vscale: 'log' }, { mode: 'mag', vscale: 'lin' }, { mode: 'phase' }],
          'iv-analyzer': [{ device: 'diode' }, { device: 'bjt-npn' }, { device: 'nmos' }],
          'spectrum-analyzer': [{ units: 'db' }, { units: 'dbm' }, { units: 'lin' }],
          'network-analyzer': [{ display: 'smith' }, { display: 's' }, { display: 'z' }, { display: 'match' }, { display: 'match', 'match.mode': 'conjugate' }, { display: 'match', 'match.mode': 'unilateral' }],
          'logic-analyzer': [{}, { clock: 'external', trigmode: 'pattern' }],
          'word-generator': [{ mode: 'cycle' }, { mode: 'step' }],
          'distortion-analyzer': [{ mode: 'thd' }, { mode: 'sinad' }],
          'bench-generator': [{}, { waveform: 'square' }, { waveform: 'ramp' }, { waveform: 'pulse' }, { waveform: 'arb', arb: 'user' }, { mod: 'am' }, { mod: 'fm' }, { mod: 'burst' }, { mod: 'sweep' }, { output: 'off', load: '50' }],
          'bench-multimeter': [{}, { math: 'null' }, { math: 'db' }, { math: 'dbm' }, { math: 'stats' }, { math: 'limit' }, { function: 'dci', range: '10m' }],
          'bench-scope': [{}, { 'math.op': 'add' }, { 'math.op': 'fft' }, { display: 'xy' }, { 'trig.source': 'ext', run: 'stop' }],
          'mixed-signal-scope': [{}, { 'dig.bus': 'bin', 'trig.source': 'd3' }, { 'dig.on': 'off' }],
        } as Partial<Record<InstrumentKind, Record<string, string>[]>>;
        const variants = VARIANTS[kind] ?? [{}];
        for (const params of variants) for (const c of untitledControls(render(kind, params))) missing.push(`${kind} ${JSON.stringify(params)}: ${c}`);
      }
      expect(missing, missing.join('\n')).toEqual([]);
    });
  }
});
