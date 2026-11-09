/**
 * Correctness review, round 4: ERC findings of a ladder program in the ERC list, in Vietnamese.
 *
 * The ERC panel shows `explainErc(m).title`, which falls back to the netlister's English message
 * when no `erc.<detail.id>.title` text exists. The ladder findings (`ladderRung`, `ladderNoProgram`,
 * `ladderNoModules`, `ladderNoChannels`, `ladderDuplicateChannel`, `ladderCommonSplit`) have no such
 * texts, so a learner whose rung names an address that does not exist reads e.g.
 * "PLC1: rung 1: ... " in English in an otherwise Vietnamese ERC list. Round 4 step 7 added more
 * ladder codes (word instructions, function blocks) through the same path and listed this as a gap;
 * this test keeps it visible. The function-block and word-instruction codes reach the learner the
 * same way.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLES_DIR } from '../../helpers';
import { parseDesign } from '../../../src/model/serialize';
import { buildNetlist } from '../../../src/model/netlister';
import { explainErc } from '../../../src/i18n/erc';
import { getLang, setLang } from '../../../src/i18n';
import type { Design, Sheet } from '../../../src/model/types';

function withBadRung(): Design {
  const d = parseDesign(readFileSync(EXAMPLES_DIR + '55-ladder-start-stop.msim', 'utf8'));
  const sheets: Sheet[] = d.sheets.map((s) => {
    if (s.kind !== 'ladder' || !s.ladder?.length) return s;
    const [first, ...rest] = s.ladder;
    // a coil on an output the controller does not have (Q9.9); the ERC list shows
    // "ladder rung 1: badAddress (Q9.9)" — English words plus the raw internal code
    return { ...s, ladder: [{ ...first, outputs: [{ kind: 'coil', address: 'Q9.9' }] }, ...rest] };
  });
  return { ...d, sheets };
}

describe('ladder ERC findings are explained in Vietnamese', () => {
  it('a rung with an address the PLC does not have', () => {
    const before = getLang();
    setLang('vi');
    try {
      const msgs = buildNetlist(withBadRung()).erc.filter((m) => m.detail?.id?.startsWith('ladder'));
      expect(msgs.length).toBeGreaterThan(0);
      for (const m of msgs) {
        const e = explainErc(m);
        // today the title IS the English netlister message
        expect(e.title, `${m.detail?.id}: ${e.title}`).not.toBe(m.message);
        expect(e.title).not.toMatch(/\b(rung|address|output|does not|not exist|unknown)\b/i);
      }
    } finally {
      setLang(before);
    }
  });
});
