/**
 * QA round 4 (QD7): Tools › Reference designator prefixes on sample 91 ("Hai bản của một khối, mỗi
 * bản một đồng hồ"). The two block copies are named X1 and X2, but the dialog lists the block
 * kind under its library prefix "HB" (example column "KH1, KH2" after typing KH). With "Đổi tên
 * cả các linh kiện đã đặt" ticked, Apply says "Đã đổi tên 0 linh kiện": X1 / X2 keep their names,
 * because renaming splits the CURRENT designator ("X") while the dialog rows come from the library
 * prefix (usedLibraryPrefixes -> "HB"). There is no "X" row to change instead.
 *
 * Expected: every row the dialog shows renames the parts it stands for (or the dialog shows the
 * prefix the parts actually carry).
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLES_DIR } from '../../../helpers';
import { loadAllGroups } from '../../../../src/library';
import { parseDesign } from '../../../../src/model/serialize';
import { applyRulesToDesign, usedLibraryPrefixes } from '../../../../src/model/refdesRules';
import { actions, partLookup } from '../../../../src/ui/store';
import type { Design } from '../../../../src/model/types';

const sample = (): Design => parseDesign(readFileSync(EXAMPLES_DIR + '91-block-meters.msim', 'utf8'));

beforeAll(async () => {
  await loadAllGroups();
});

describe('QD7: prefix rules rename the hierarchical-block copies of sample 91', () => {
  it('the rows the dialog lists cover the designators in the design', () => {
    const d = sample();
    // the dialog looks parts up through the editor store, which resolves block parts of the open design
    actions.loadDesign(d, '91-block-meters.msim');
    const top = d.sheets.flatMap((s) => s.parts).map((p) => p.refdes);
    expect(top).toEqual(expect.arrayContaining(['X1', 'X2']));
    const rows = usedLibraryPrefixes(d, partLookup);
    // the dialog has no "X" row, only "HB" (the library prefix of a hierarchical block)
    expect(rows).toContain('X');
  });

  it('mapping every listed row to a new prefix renames X1 and X2', () => {
    const d = sample();
    actions.loadDesign(d, '91-block-meters.msim');
    const rows = usedLibraryPrefixes(d, partLookup);
    const map = Object.fromEntries(rows.map((p) => [p, `Q${p}`]));
    const r = applyRulesToDesign(d, { map });
    const names = r.design.sheets.flatMap((s) => s.parts).map((p) => p.refdes);
    expect(names).not.toContain('X1');
    expect(names).not.toContain('X2');
  });
});
