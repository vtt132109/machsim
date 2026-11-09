import { describe, expect, it } from 'vitest';
import type { InstrumentBinding, InstrumentKind } from '../../model/types';
import { instrumentNeed } from './needs';
import { PANEL_TITLES, PANEL_WIDTHS, instrumentPanels, panelTitle } from './registry';
import { INSTRUMENT_CHANNELS } from './types';
import { setLang } from '../../i18n';

// these tests assert the English UI texts (the app defaults to Vietnamese)
setLang('en');

const v = (pos: string) => ({ kind: 'voltage' as const, pos, neg: '0' });

function binding(kind: InstrumentKind, channels: InstrumentBinding['channels'], drives: string[] = []): InstrumentBinding {
  return { refdes: 'X1', partId: `instruments/${kind}`, kind, params: {}, channels, drives };
}

describe('instrument registry', () => {
  it('has a panel, title and width for every instrument kind', () => {
    for (const kind of Object.keys(INSTRUMENT_CHANNELS) as InstrumentKind[]) {
      expect(typeof instrumentPanels[kind], kind).toBe('function');
      expect(PANEL_TITLES[kind].length).toBeGreaterThan(3);
      expect(PANEL_WIDTHS[kind]).toBeGreaterThanOrEqual(260);
    }
    expect(panelTitle('oscilloscope', 'XSC1')).toBe('Oscilloscope – XSC1');
    expect(panelTitle('bode-plotter')).toBe('Bode Plotter');
  });
});

describe('instrumentNeed', () => {
  it('stream-only instruments need nothing else', () => {
    expect(instrumentNeed(binding('oscilloscope', { A: v('a') }), {})).toEqual({ kind: 'stream' });
    expect(instrumentNeed(binding('multimeter', { v: v('a') }), { mode: 'v' })).toEqual({ kind: 'stream' });
  });

  it('Bode plotter needs the AC sweep of its settings', () => {
    expect(instrumentNeed(binding('bode-plotter', { in: v('i'), out: v('o') }), { fstart: '10', fstop: '100k', points: '20' })).toEqual({
      kind: 'ac',
      spec: { type: 'ac', sweep: 'dec', points: 20, fstart: 10, fstop: 1e5 },
    });
    expect(instrumentNeed(binding('bode-plotter', { in: v('i') }), {}).kind).toBe('none');
  });

  it('network analyzer names its forward / reverse port sources', () => {
    const need = instrumentNeed(binding('network-analyzer', { p1: v('a'), p2: v('b') }, ['V_XNA1_1', 'V_XNA1_2']), {});
    expect(need).toMatchObject({ kind: 'ac-two-port', forward: 'V_XNA1_1', reverse: 'V_XNA1_2' });
    const one = instrumentNeed(binding('network-analyzer', { p1: v('a') }, ['V_XNA1_1']), {});
    expect(one).toMatchObject({ kind: 'ac-two-port', forward: 'V_XNA1_1', reverse: undefined });
  });

  it('IV analyzer needs its nested DC sweep', () => {
    const need = instrumentNeed(binding('iv-analyzer', { i: { kind: 'current', element: 'V_XIV1_i' } }, ['V_XIV1_v']), { device: 'diode' });
    expect(need).toEqual({ kind: 'dc', spec: { type: 'dc', src: 'V_XIV1_v', start: 0, stop: 1, step: 0.01 } });
    expect(instrumentNeed(binding('iv-analyzer', { i: { kind: 'current', element: 'V_XIV1_i' } }, ['V_XIV1_v']), { device: 'nmos' }).kind).toBe('none');
  });

  it('logic converter needs one operating point per truth-table row', () => {
    const need = instrumentNeed(binding('logic-converter', { out: v('y') }, ['V_XLC1_A', 'V_XLC1_B']), { inputs: '2', vhigh: '3.3' });
    expect(need.kind).toBe('op-rows');
    if (need.kind !== 'op-rows') return;
    expect(need.rows).toHaveLength(4);
    expect(need.rows[2]).toEqual({ row: 2, values: { V_XLC1_A: 3.3, V_XLC1_B: 0 } });
  });
});
