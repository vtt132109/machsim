/**
 * Every generated catalogue part builds a netlist (ERC clean) and solves an operating point in a
 * biased test bench (src/library/catalog/bench.ts); one part per family also runs a short
 * transient. Families run as separate tests so a failure names the family.
 */
import { describe, expect, it } from 'vitest';
import { listParts } from '../index';
import { asLibraryPart } from '../partkit';
import type { PartDef } from '../types';
import { runAnalyses } from '../../sim';
import { measureBench } from './bench';
import { loadAllGroups } from '../index';

// the catalogue packs load on demand (src/library/index.ts): load them all so every part is covered
await loadAllGroups();

const catalogue = listParts().filter((p) => asLibraryPart(p).series !== undefined || asLibraryPart(p).textVi !== undefined);

const byFamily = new Map<string, PartDef[]>();
for (const p of catalogue) {
  const k = `${p.group} › ${p.family}`;
  const list = byFamily.get(k);
  if (list) list.push(p);
  else byFamily.set(k, [p]);
}

describe('catalogue size', () => {
  it('has thousands of generated parts in many families', () => {
    expect(catalogue.length).toBeGreaterThanOrEqual(300);
    expect(byFamily.size).toBeGreaterThanOrEqual(5);
  });
});

describe.each([...byFamily.entries()].map(([k, parts]) => [k, parts] as const))('family %s', (_k, parts) => {
  it('every part passes ERC and solves an operating point in a biased bench', () => {
    const failures: string[] = [];
    for (const part of parts) {
      let build;
      try {
        build = measureBench(part.id);
      } catch (e) {
        failures.push(`${part.id}: netlist ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const errs = build.erc.filter((m) => m.severity === 'error');
      if (errs.length) {
        failures.push(`${part.id}: ERC ${errs[0].message}`);
        continue;
      }
      if (!part.toSpice) continue;
      const [op] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
      if (op.error) failures.push(`${part.id}: OP ${op.error}`);
      else if (op.vectors.some((v) => !Number.isFinite(v.re[0]))) failures.push(`${part.id}: OP has non-finite values`);
    }
    expect(failures).toEqual([]);
  });

  it('a sample part runs a 1 ms transient', () => {
    const sample = parts.find((p) => p.toSpice);
    if (!sample) return;
    const build = measureBench(sample.id);
    const [tr] = runAnalyses({ ...build.netlist, analyses: [{ type: 'tran', tstep: 1e-5, tstop: 1e-3 }] });
    expect(tr.error, sample.id).toBeUndefined();
  });
});
