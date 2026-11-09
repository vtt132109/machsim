/**
 * Static render of the setup dialog (react-dom/server, no DOM) for every analysis type: checks
 * each form renders its fields, nested base editors appear for meta analyses, and validation
 * messages / disabled buttons follow the spec.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AnalysisSpec, AnalysisType } from '../../sim/netlist';
import { AnalysisSetupDialog } from './AnalysisSetupDialog';
import type { AnalysisSetupDialogProps } from './AnalysisSetupDialog';
import { ANALYSIS_CATALOG } from './specs';
import { setLang } from '../../i18n';

// these tests assert the English UI texts (the app defaults to Vietnamese)
setLang('en');

const noop = () => {};

function render(active: AnalysisType, specs: Partial<Record<AnalysisType, AnalysisSpec>> = {}, extra: Partial<AnalysisSetupDialogProps> = {}): string {
  return renderToStaticMarkup(
    createElement(AnalysisSetupDialog, {
      specs,
      active,
      options: {},
      availableOutputs: ['V(in)', 'V(out)', 'I(V1)'],
      availableSources: ['V1'],
      availableElements: ['R1', 'C1'],
      onChange: noop,
      onRun: noop,
      onClose: noop,
      ...extra,
    }),
  );
}

/** Text content with tags removed. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const EXPECTED_LABELS: Record<AnalysisType, string[]> = {
  op: ['no parameters'],
  dc: ['Source 1', 'Start value', 'Increment', 'Use source 2'],
  ac: ['Sweep type', 'Start frequency', 'Points per decade'],
  acsingle: ['Frequency'],
  tran: ['End time (TSTOP)', 'Maximum time step (TMAX)', 'Initial conditions'],
  noise: ['Output node', 'Input noise reference source', 'Stop frequency'],
  tf: ['Output', 'Input source'],
  sens: ['AC sensitivity'],
  pz: ['Transfer function', 'Input (+)', 'Output (−)', 'Poles and zeros'],
  four: ['Fundamental frequency', 'Number of harmonics', 'Outputs (1 selected)'],
  disto: ['Intermodulation'],
  noisefig: ['Source resistance'],
  paramsweep: ['Sweep parameter', 'Generate', 'Analysis to repeat'],
  tempsweep: ['Temperatures', 'Analysis to repeat'],
  montecarlo: ['Number of runs', 'Tolerances (1)', 'Analysis to repeat'],
  worstcase: ['Measurement to push', 'Direction', 'Analysis to repeat'],
  nestedsweep: ['Outer sweep', 'Inner sweep', '6 runs'],
  tracewidth: ['Allowed temperature rise', 'Copper weight', 'End time (TSTOP)'],
  batch: ['1. DC Operating Point', 'Add to batch'],
  user: ['SPICE control cards', 'Insert', 'Analysis cards to run: 2'],
};

describe('AnalysisSetupDialog', () => {
  it('renders a complete form for every analysis type', () => {
    for (const a of ANALYSIS_CATALOG) {
      const t = text(render(a.type));
      expect(t, a.type).toContain(a.title);
      for (const label of EXPECTED_LABELS[a.type]) expect(t, `${a.type}: ${label}`).toContain(label);
      expect(t).toContain('Ready:');
    }
  });

  it('lists every analysis in the navigation and the standard tabs', () => {
    const t = text(render('tran'));
    for (const a of ANALYSIS_CATALOG) expect(t).toContain(a.title);
    expect(t).toContain('Analysis parameters');
    expect(t).toContain('Analysis options');
    expect(t).toContain('Summary');
    expect(t).not.toContain('Output variables');
  });

  it('shows the stored settings and validation errors, disabling Save and Run', () => {
    const html = render('tran', { tran: { type: 'tran', tstep: 1e-2, tstop: 1e-3 } });
    expect(html).toContain('value="10m"');
    expect(html).toContain('value="1m"');
    expect(text(html)).toContain('Time step must not exceed the end time');
    expect(text(html)).toContain('1 error to fix before running');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Run<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/);
  });

  it('renders nested base analyses with their own fields', () => {
    const html = render('paramsweep', {
      paramsweep: { type: 'paramsweep', target: 'R1', param: 'value', values: [1e3, 4.7e3], base: { type: 'ac', sweep: 'lin', points: 33, fstart: 0, fstop: 1e3 } },
    });
    expect(html).toContain('1k, 4.7k');
    expect(text(html)).toContain('Number of points');
    expect(html).toContain('value="33"');
  });

  it('adds the output tab when saves are editable', () => {
    const tab = /<button[^>]*role="tab"[^>]*>Output<\/button>/;
    expect(render('op', {}, { saves: ['V(out)'], onSavesChange: noop })).toMatch(tab);
    expect(render('op')).not.toMatch(tab);
  });
});
