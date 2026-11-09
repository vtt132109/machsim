/**
 * QA round 4 (QD5): Simulate > Analysis settings > Parameter sweep never offers
 * "Tham số toàn cục (biến)" (Global parameter (variable)) in the app.
 *
 * Sample 92's note and the round-4 lesson tell the learner to choose that option, and the form
 * (src/ui/analysis/forms.tsx SweepTarget) shows it only when `ctx.variables` is non-empty. The
 * dialog the app opens (src/ui/integration/analysisSettings.tsx -> AnalysisSetupDialog) computes
 * specContext(...) with `variables`, but only passes outputs / sources / elements on, and
 * AnalysisSetupDialog builds its FormContext from those three alone, so the option is missing.
 *
 * Repro in the app: open sample "Quét tham số mạch vẽ bằng dòng .step", pick "Quét tham số" in
 * the analysis box, press "Thiết lập…": the "Quét theo" list has only "Tham số linh kiện" and
 * "Tham số model".
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAllGroups } from '../../../../src/library';
import { parseDesign } from '../../../../src/model/serialize';
import { setLang } from '../../../../src/i18n';
import { actions } from '../../../../src/ui/store';
import { AnalysisSettings } from '../../../../src/ui/integration/analysisSettings';
import type { SimulationIntegration } from '../../../../src/ui/integration/controller';

beforeAll(async () => {
  await loadAllGroups();
  setLang('vi');
});

describe('QD5: Parameter sweep of a global variable is reachable from the analysis dialog', () => {
  it('sample 92 (Rx is a design variable): "Quét theo" offers "Tham số toàn cục (biến)"', () => {
    const text = readFileSync(fileURLToPath(new URL('../../../../examples/92-step-sweep.msim', import.meta.url)), 'utf8');
    const parsed = parseDesign(text) as unknown;
    const design = (parsed as { design?: unknown }).design ?? parsed;
    const d = design as Parameters<typeof actions.loadDesign>[0];
    expect(d.variables).toMatchObject({ Rx: '1k' });
    actions.loadDesign({ ...d, analysis: { ...d.analysis, active: 'paramsweep' } }, '92-step-sweep.msim');
    const html = renderToStaticMarkup(createElement(AnalysisSettings, { ctrl: {} as unknown as SimulationIntegration, close: () => {} }));
    expect(html).toContain('Quét tham số');
    expect(html).toContain('Tham số toàn cục (biến)');
  });
});
